import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  SnapshotVariant,
  StoreUserContext,
} from "../../../types/index.ts";

import { storeUserContextWithSnapshotAccounts } from "./snapshot-store-user-context.ts";

const variant = (steamId64: string, index: number): SnapshotVariant => ({
  variantId: String(index).repeat(64),
  kind: "steam-account",
  steamId64,
});

describe("Cloud Save snapshot Steam accounts", () => {
  it("adds every remote account without replacing the active local account", () => {
    const local: StoreUserContext = {
      active: {
        store: "steam",
        steamId64: "76561197960278073",
        accountId32: "12345",
        source: "active-login",
      },
      known: [
        {
          store: "steam",
          steamId64: "76561197960278073",
          accountId32: "12345",
          source: "active-login",
        },
      ],
    };

    const result = storeUserContextWithSnapshotAccounts(local, [
      variant("76561199800542110", 1),
      variant("76561199865645641", 2),
      variant("76561198835007011", 3),
    ]);

    assert.equal(result.active, local.active);
    assert.equal(result.known.length, 4);
    assert.deepEqual(
      result.known
        .filter((account) => account.source === "remote-snapshot")
        .map((account) => [account.steamId64, account.accountId32]),
      [
        ["76561198835007011", "874741283"],
        ["76561199800542110", "1840276382"],
        ["76561199865645641", "1905379913"],
      ]
    );
  });

  it("keeps local metadata when the same account also exists remotely", () => {
    const local: StoreUserContext = {
      known: [
        {
          store: "steam",
          steamId64: "76561198051718575",
          accountId32: "91452847",
          source: "known-login",
        },
      ],
    };

    const result = storeUserContextWithSnapshotAccounts(local, [
      variant("76561198051718575", 1),
      { variantId: "2".repeat(64), kind: "default" },
      {
        variantId: "3".repeat(64),
        kind: "opaque-folder",
        concreteFolderId: "Goldberg",
      },
    ]);

    assert.deepEqual(result, local);
  });

  it("rejects a Steam ID outside the individual account range", () => {
    assert.throws(() =>
      storeUserContextWithSnapshotAccounts({ known: [] }, [
        variant("76561202255233024", 1),
      ])
    );
  });
});
