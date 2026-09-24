// Stands in for efcpt-ui-engine in unit tests. Behaviour is chosen with FAKE_ENGINE_MODE.
const args = process.argv.slice(2);
const mode = process.env.FAKE_ENGINE_MODE ?? 'ok';
const connection = args[0];

if (args.includes('--version')) {
  console.log('efcpt.10 10.0.0+test');
  process.exit(0);
}

const base = { schemaVersion: 1, success: true, errors: [], warnings: [] };
process.stderr.write(`Getting database objects from ${connection}...\nsecond line`);

switch (mode) {
  case 'ok':
    if (args.includes('--list-objects')) {
      console.log(
        JSON.stringify({
          ...base,
          command: 'list-objects',
          efCoreVersion: 10,
          databaseType: 'SQLite',
          objects: [{ displayName: 'Customers', name: 'Customers', type: 'table', columns: [] }],
          args,
        }),
      );
    } else {
      console.log(JSON.stringify({ ...base, command: 'generate', entityTypeFilePaths: ['/out/Customer.cs'], args }));
    }
    break;
  case 'error':
    console.log(JSON.stringify({ ...base, command: 'list-objects', success: false, errors: [`cannot open ${connection}`] }));
    process.exit(1);
    break;
  case 'garbage':
    console.log('this is not json');
    process.exit(3);
    break;
  case 'future':
    console.log(JSON.stringify({ ...base, schemaVersion: 99, command: 'list-objects' }));
    break;
  case 'hang':
    setTimeout(() => {}, 60_000);
    break;
}
