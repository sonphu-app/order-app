import { supabase } from "../supabaseClient";
import { clearLocalData } from "./localSync";

async function deleteAllRows(table) {
  const { error } = await supabase.from(table).delete().not("id", "is", null);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function clearStorageBucket() {
  let offset = 0;
  const paths = [];
  while (true) {
    const { data, error } = await supabase.storage
      .from("order-images")
      .list("", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Storage: ${error.message}`);
    paths.push(...(data || []).filter((item) => item.id).map((item) => item.name));
    if ((data || []).length < 100) break;
    offset += 100;
  }
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage.from("order-images").remove(paths.slice(index, index + 100));
    if (error) throw new Error(`Storage: ${error.message}`);
  }
}

export async function resetAllData() {
  try {
    for (const table of [
      "order_message_images",
      "order_messages",
      "group_message_images",
      "group_messages",
      "order_images",
      "order_edit_history",
      "orders",
    ]) {
      await deleteAllRows(table);
    }
    await clearStorageBucket();
    await clearLocalData();
    alert("Đã xóa dữ liệu đơn hàng, chat và ảnh. Tài khoản nhân viên vẫn được giữ lại.");
    window.location.reload();
  } catch (err) {
    console.error("resetAllData error:", err);
    alert(`Reset dữ liệu thất bại: ${err.message}`);
  }
}
