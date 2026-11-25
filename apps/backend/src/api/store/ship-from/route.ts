import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { parseProductIdsQuery } from "../../../lib/catalog/middlewares/store";
import { getShipFromStates } from "../../../lib/ship-from";
import { defineAllowlistSerializer } from "../../../lib/serializers/define-allowlist-serializer";

// The only fields that leave this route: a product id and state codes with names.
const entrySerializer = defineAllowlistSerializer<{
  product_id: string;
  states: { code: string; name: string }[];
}>({
  name: "store-ship-from",
  audience: "store",
  shape: { product_id: true, states: { code: true, name: true } },
});

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ids = parseProductIdsQuery(req);
  const states = await getShipFromStates(req.scope, ids);

  const entries = ids
    .filter((id) => (states.get(id)?.length ?? 0) > 0)
    .map((id) => ({ product_id: id, states: states.get(id) ?? [] }));

  res.json({ ship_from: entrySerializer.serializeMany(entries) });
}
