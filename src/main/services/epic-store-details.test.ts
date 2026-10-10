import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEpicLocale, getEpicStoreDetails } from "./epic-store-details.js";

describe("Epic localized store details", () => {
  it("uses explicit regional locales", () => {
    assert.equal(getEpicLocale("pt-BR"), "pt-BR");
    assert.equal(getEpicLocale("en"), "en-US");
    assert.equal(getEpicLocale("ru"), "ru");
  });
  it("matches the exact granted item and keeps developer/publisher independent", async () => {
    let calls = 0;
    const request: typeof fetch = async (_url, init) => {
      calls++;
      const { variables, query } = JSON.parse(String(init?.body));
      assert.equal(variables.locale, "pt-BR");
      if (query.includes("searchStore"))
        return Response.json({
          data: {
            Catalog: {
              searchStore: {
                elements: [
                  {
                    id: "base",
                    namespace: "ns",
                    items: [{ id: "item", namespace: "ns" }],
                    tags: [
                      { id: "1336", name: "Action-Adventure" },
                      { id: "21894", name: "Cloud Saves" },
                    ],
                    keyImages: [],
                  },
                ],
              },
            },
          },
        });
      return Response.json({
        data: {
          Catalog: {
            catalogOffers: {
              elements: [
                {
                  id: "wrong",
                  title: "Same name",
                  items: [{ id: "another", namespace: "ns" }],
                  longDescription: "Wrong",
                },
                {
                  id: "base",
                  title: "Game",
                  items: [{ id: "item", namespace: "ns" }],
                  longDescription: "Descrição longa",
                  description: "Resumo",
                  developerDisplayName: "Developer",
                  publisherDisplayName: "Publisher",
                },
              ],
            },
          },
          Product: { sandbox: null },
        },
      });
    };
    const result = await getEpicStoreDetails("ns:item", "pt-BR", request);
    assert.equal(result?.about_the_game, "Descrição longa");
    assert.deepEqual(result?.developers, ["Developer"]);
    assert.deepEqual(result?.publishers, ["Publisher"]);
    assert.deepEqual(result?.genres, [{ id: "1336", name: "Ação e aventura" }]);
    assert.equal(calls, 2);
  });
  it("does not retry rate limits", async () => {
    let calls = 0;
    await assert.rejects(
      getEpicStoreDetails("ns:item", "en", async () => {
        calls++;
        return new Response(null, { status: 429 });
      })
    );
    assert.equal(calls, 1);
  });
  it("rejects ambiguous base offers", async () => {
    const offer = {
      items: [{ id: "item", namespace: "ns" }],
      longDescription: "Long",
    };
    const result = await getEpicStoreDetails("ns:item", "en", async () =>
      Response.json({
        data: { Catalog: { catalogOffers: { elements: [offer, offer] } } },
      })
    );
    assert.equal(result, null);
  });
});
