"use client"

import type { EquipmentMode } from "@compass/domain"
import { create } from "zustand"

export type LibrarySort = "name" | "length" | "payload"

type LibraryState = {
  query: string
  mode: EquipmentMode | "ALL"
  openOnly: boolean
  oogOnly: boolean
  sort: LibrarySort
  selectedId: string | null
  setQuery: (query: string) => void
  setMode: (mode: EquipmentMode | "ALL") => void
  setOpenOnly: (openOnly: boolean) => void
  setOogOnly: (oogOnly: boolean) => void
  setSort: (sort: LibrarySort) => void
  setSelectedId: (selectedId: string | null) => void
}

export const useEquipmentLibrary = create<LibraryState>((set) => ({
  query: "",
  mode: "ALL",
  openOnly: false,
  oogOnly: false,
  sort: "name",
  selectedId: null,
  setQuery: (query) => set({ query }),
  setMode: (mode) => set({ mode }),
  setOpenOnly: (openOnly) => set({ openOnly }),
  setOogOnly: (oogOnly) => set({ oogOnly }),
  setSort: (sort) => set({ sort }),
  setSelectedId: (selectedId) => set({ selectedId }),
}))
