# Download source backups

In **Settings → Download sources**, choose **Export sources** to save all
configured source URLs in a JSON file. Keep the file for a reinstall or share it
with someone who wants to import the same sources.

Choose **Import sources** and select the exported file to add its sources using
Hydra's normal source registration flow. Importing requires an internet
connection. Existing sources are preserved, and repeated URLs are skipped. The
result lists added and skipped counts, as well as any failed URLs. Import the
same file again to retry failures without duplicating successful additions.
An ongoing transfer stays busy when navigating away from settings and back.
Conflicting source changes are also blocked in the main process until the active
source operation finishes.

The backup contains URLs only; game downloads, cached catalogue data, account
credentials, and local database IDs are not included. Source URLs are preserved
as configured, including any query parameters.

## File format

```json
{
  "version": 1,
  "sources": [{ "url": "https://example.com/source.json" }]
}
```

Imports accept version 1, HTTP(S) URLs, and files up to 1 MiB. The entire file
is validated before any source is added. Unsupported versions, malformed entries,
and oversized files leave the configured sources unchanged. Cancelling a file
dialog performs no operation.

## Focused tests

```sh
node --import ./scripts/register-ts-node.mjs --test src/main/services/download-source-backup.test.ts
node --import ./scripts/register-ts-node.mjs --test src/main/services/download-source-operation-gate.test.ts src/renderer/src/features/download-source-transfer.test.ts
```

For manual verification, export at least two sources, import that file in a fresh
profile, then import it again. Check that the second import skips every URL.
Also check invalid JSON, cancelling both dialogs, and a backup containing an
unavailable source: other sources should still be added, and the failed URL
should appear in the result.
During a long import, switch settings categories and return: source controls
should remain disabled. When it finishes, the full source list and import result
should be available, and the result button should use the selected language.
