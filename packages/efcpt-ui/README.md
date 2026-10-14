# Moved to efcpt-cli

efcpt-ui is now **efcpt-cli**, in [`packages/efcpt-cli`](../efcpt-cli). The command is `efcpt`.

This folder only exists so that `efcpt --update` from a version before the rename can finish the move: its update script builds this folder, and the build here runs the new update script. That builds efcpt-cli, points your `efcpt` shell function at the new folder and replaces a global `efcpt-ui` npm link. Delete this folder once everyone has updated.
