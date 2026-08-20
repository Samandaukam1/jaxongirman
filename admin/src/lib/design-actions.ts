import { archiveDesign, deleteDesign, duplicateDesign, publishDesign, restoreDesign, type DesignRow } from "@/lib/jslayd";
import { errorMessage } from "@/lib/format";

/**
 * What an admin does to a design from a list, whichever list it is.
 *
 * Publishing, archiving, deleting and duplicating mean exactly the same thing
 * for a design somebody wrote and a design somebody imported — the row is the
 * same row and the server enforces the same rules — so they live here rather
 * than being typed twice with two chances to drift.
 *
 * Every one of them confirms first and says what it costs, with the number in
 * it. None of them decides anything the server also decides: a refusal comes
 * back as a sentence, which is the part worth showing.
 */

export async function guard(
  action: () => Promise<unknown>,
  reload: () => Promise<void>,
  onError: (message: string) => void,
) {
  try {
    await action();
    await reload();
  } catch (error) {
    onError(errorMessage(error));
  }
}

export async function archive(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  // Archiving is reversible and decks keep rendering from their pinned version,
  // but a design in use is still worth pausing over.
  const warning = item.used_by > 0
    ? `«${item.name}» ${item.used_by} ta taqdimotda ishlatilgan. Arxivlash uni tanlash ro‘yxatidan olib tashlaydi, mavjud taqdimotlar ochilaveradi. Davom etamizmi?`
    : `«${item.name}» arxivlansinmi?`;
  if (!window.confirm(warning)) return;
  await guard(() => archiveDesign(item.id, null), reload, onError);
}

export async function restore(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  await guard(() => restoreDesign(item.id), reload, onError);
}

/**
 * Deleting, which is not archiving.
 *
 * `presentations.design_id` is `set null`, so this is survivable: decks made
 * with the design keep opening, exporting and printing, because their slides
 * are already rows. What they lose is the record of what drew them and the
 * ability to be re-generated in it.
 *
 * A deck made from a PowerPoint template loses more than that, and the warning
 * says so: its export clones the uploaded package, and deleting the design
 * deletes the package.
 */
export async function remove(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  const template = item.design_source === "pptx";
  const consequence = item.used_by > 0
    ? `${item.used_by} ta taqdimot shu dizayn bilan yaratilgan. `
      + (template
        ? "Ular ochilaveradi, lekin PowerPoint fayli o‘chgani uchun .pptx eksporti ishlamay qoladi.\n\n"
        : "Ular ochilaveradi va eksport qilinaveradi, lekin qaysi dizayn bilan yaratilgani yozuvi yo‘qoladi va ular shu dizaynda qayta yaratilmaydi.\n\n")
    : "";
  const warning = `«${item.name}» butunlay o‘chirilsinmi?\n\n${consequence}`
    + "Sahifalari, shriftlari va yuklangan shablon fayli ham o‘chadi. Bu amalni qaytarib bo‘lmaydi.";
  if (!window.confirm(warning)) return;
  await guard(() => deleteDesign(item.id, item.used_by > 0), reload, onError);
}

export async function publish(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  const already = item.published_version > 0;
  const warning = already
    ? `«${item.name}» yangi versiyada chop etilsinmi? Telefonlar keyingi ochilishda shuni oladi.`
    : `«${item.name}» chop etilsinmi? Shundan keyin u foydalanuvchilarga ko‘rinadi.`;
  if (!window.confirm(warning)) return;
  await guard(() => publishDesign(item.id), reload, onError);
}

export async function duplicate(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  const slug = window.prompt("Yangi slug", `${item.slug}-copy`);
  if (!slug) return;
  await guard(() => duplicateDesign(item.id, slug, `${item.name} Copy`), reload, onError);
}
