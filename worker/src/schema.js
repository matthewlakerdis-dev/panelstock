// Even no-op DDL is a write statement. Read the catalog first so warm schemas
// can start when the provider has temporarily disabled database writes.
export function ensureSchema(sql,statement){
 const match=statement.match(/^CREATE (?:UNIQUE )?(TABLE|INDEX) IF NOT EXISTS ([a-z_][a-z0-9_]*)/i);
 if(!match)throw Error('Expected an idempotent schema definition');
 if(sql.exec('SELECT name FROM sqlite_master WHERE type=? AND name=?',match[1].toLowerCase(),match[2]).toArray().length)return;
 sql.exec(statement);
}
export const isWriteQuotaError=error=>/Exceeded allowed rows written in Durable Objects free tier/i.test(String(error?.message||error));
