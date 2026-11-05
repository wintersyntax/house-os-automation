/** Cloud Run Job entrypoint. Execute, report counts, exit; no household data in logs. */
import { createReader } from './read-only.js';

async function main() {
  const readInventory = createReader({
    key: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_READ_TOKEN,
    boardId: process.env.TRELLO_BOARD_ID,
  });
  const { inventory, shoppingAttention } = await readInventory();
  console.log(JSON.stringify({
    kind: 'HOUSE_OS_READONLY_INVENTORY',
    ok: true,
    inventoryCount: inventory.length,
    shoppingAttentionCount: shoppingAttention.length,
  }));
}
main().catch(error => {
  console.error('House OS read-only inventory: RED — ' + error.message);
  process.exitCode = 1;
});
