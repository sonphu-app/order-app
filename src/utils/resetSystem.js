import { supabase } from "../supabaseClient";

export async function resetAllData() {
  try {
    // Xóa dữ liệu chính
    await supabase.from("order_message_images").delete().neq("id", 0);
    await supabase.from("order_messages").delete().neq("id", 0);
    await supabase.from("group_message_images").delete().neq("id", 0);
    await supabase.from("group_messages").delete().neq("id", 0);
    await supabase.from("orders").delete().neq("id", 0);

    // Nếu bạn muốn reset luôn user nhân viên thì mở dòng dưới:
    // await supabase.from("users").delete().neq("id", "");

    // Xóa session local hiện tại nếu app bạn còn lưu
    localStorage.removeItem("currentUser");

    window.location.reload();
  } catch (err) {
    console.error("resetAllData error:", err);
    alert("Reset dữ liệu thất bại. Mở console kiểm tra lỗi.");
  }
}