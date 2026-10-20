"use client"

import { create } from "zustand"

type LibraryState = {
  selectedId: string | null
  setSelectedId: (selectedId: string | null) => void
}

export const useEquipmentLibrary = create<LibraryState>((set) => ({
  selectedId: null,
  setSelectedId: (selectedId) => set({ selectedId }),
}))
