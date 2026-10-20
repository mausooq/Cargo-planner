export function equipmentFormKey(item?: { id: string } | null) {
  return item?.id ?? "new"
}
