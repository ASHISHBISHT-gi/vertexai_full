import type { Db } from "../../db/pool";

/** Writes one line to the audit trail. Call it inside the same transaction as the change it describes. */
export async function audit(db: Db, actorId: string | null, action: string, entity: string, entityId: string | null, metadata: unknown = {}) {
  await db.query("INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)", [
    actorId, action, entity, entityId, JSON.stringify(metadata),
  ]);
}
