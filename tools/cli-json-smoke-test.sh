#!/usr/bin/env bash
# End-to-end smoke test of the efcpt --list-objects / --json options against a throwaway SQLite database.
# Usage: tools/cli-json-smoke-test.sh <path to built efcpt.N.dll>
# Requires: dotnet, python3
set -euo pipefail

EFCPT_DLL="$(realpath "${1:?usage: $0 <path to efcpt.N.dll>}")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

efcpt() { timeout 300 dotnet "$EFCPT_DLL" "$@"; }

python3 - <<'EOF'
import sqlite3
c = sqlite3.connect('shop.db')
c.executescript("""
CREATE TABLE Customers(Id INTEGER PRIMARY KEY, Name TEXT NOT NULL);
CREATE TABLE Orders(Id INTEGER PRIMARY KEY, CustomerId INTEGER NOT NULL REFERENCES Customers(Id), Total REAL);
CREATE TABLE AuditLog(Id INTEGER PRIMARY KEY, Message TEXT);
CREATE VIEW BigOrders AS SELECT * FROM Orders WHERE Total > 100;
""")
c.commit()
EOF
CONN="Data Source=$WORK/shop.db"

echo "--- list-objects --json"
efcpt "$CONN" sqlite --list-objects --json > list.json
python3 - <<'EOF'
import json, os
d = json.load(open('list.json'))
assert d['schemaVersion'] == 1 and d['command'] == 'list-objects' and d['success'], d
names = sorted((o['displayName'], o['type']) for o in d['objects'])
assert names == [('AuditLog', 'table'), ('BigOrders', 'view'), ('Customers', 'table'), ('Orders', 'table')], names
orders = next(o for o in d['objects'] if o['name'] == 'Orders')
assert any(c['name'] == 'CustomerId' and c['isForeignKey'] for c in orders['columns']), orders
assert not os.path.exists('efcpt-config.json'), 'list-objects must not write the config file'
EOF

echo "--- generate --json with config round trip"
cat > efcpt-config.json <<'EOF'
{
  "$schema": "./local.schema.json",
  "efcpt-ui": { "connection": { "env": "SHOP_DB" } },
  "code-generation": { "refresh-object-lists": true },
  "tables": [ { "name": "AuditLog", "exclude": true } ]
}
EOF
efcpt "$CONN" sqlite --json > generate.json
python3 - <<'EOF'
import json, os
d = json.load(open('generate.json'))
assert d['command'] == 'generate' and d['success'], d
files = sorted(os.path.basename(p) for p in d['entityTypeFilePaths'])
assert files == ['BigOrder.cs', 'Customer.cs', 'Order.cs'], files
assert all(os.path.exists(p) for p in d['entityTypeFilePaths'] + [d['contextFilePath']])
c = json.load(open('efcpt-config.json', encoding='utf-8-sig'))
assert c['$schema'] == './local.schema.json', c['$schema']
assert c['efcpt-ui'] == {'connection': {'env': 'SHOP_DB'}}, c.get('efcpt-ui')
EOF

echo "--- errors are reported as JSON with a non-zero exit code"
check_error() {
  local name="$1"; shift
  set +e; efcpt "$@" > error.json; local code=$?; set -e
  [ "$code" -ne 0 ] || { echo "$name: expected non-zero exit code"; exit 1; }
  python3 -c "import json; d=json.load(open('error.json')); assert not d['success'] and d['errors'], d"
  echo "$name: ok (exit $code)"
}
check_error "missing database" "Data Source=$WORK/missing/nope.db" sqlite --list-objects --json
check_error "unknown provider" "$CONN" bogus --list-objects --json
echo '{ not json' > broken.json
check_error "broken config file" "$CONN" sqlite -i broken.json --json
check_error "invalid arguments" --json --no-such-option

echo "All efcpt JSON smoke tests passed"
