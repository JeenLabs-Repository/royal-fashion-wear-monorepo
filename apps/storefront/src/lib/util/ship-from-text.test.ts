import assert from "node:assert/strict"
import { describe, it } from "node:test"

// The storefront type-check does not allow import suffixes, and node needs one.
// @ts-expect-error TS5097 for the .ts suffix; the runtime import is correct
import { buildShipFromText } from "./ship-from-text.ts"

const labels = {
  shipFrom: (statesText: string) => `Ships from ${statesText}`,
  multiple: "Ships from multiple states",
  and: "and",
}

const state = (code: string, name: string) => ({ code, name })
const KA = state("IN-KA", "Karnataka")
const MH = state("IN-MH", "Maharashtra")
const TN = state("IN-TN", "Tamil Nadu")
const DL = state("IN-DL", "Delhi")
const GJ = state("IN-GJ", "Gujarat")

describe("buildShipFromText", () => {
  it("returns null for no states", () => {
    assert.equal(buildShipFromText([], labels), null)
  })

  it("names one state", () => {
    assert.equal(buildShipFromText([TN], labels), "Ships from Tamil Nadu")
  })

  it("joins two states with the and word", () => {
    assert.equal(
      buildShipFromText([MH, KA], labels),
      "Ships from Karnataka and Maharashtra"
    )
  })

  it("joins three states as A, B and C", () => {
    assert.equal(
      buildShipFromText([TN, KA, MH], labels),
      "Ships from Karnataka, Maharashtra and Tamil Nadu"
    )
  })

  it("collapses four states to the multiple label", () => {
    assert.equal(
      buildShipFromText([TN, KA, MH, DL], labels),
      "Ships from multiple states"
    )
  })

  it("collapses five states to the multiple label", () => {
    assert.equal(
      buildShipFromText([TN, KA, MH, DL, GJ], labels),
      "Ships from multiple states"
    )
  })

  it("sorts unsorted input by state name", () => {
    assert.equal(
      buildShipFromText([TN, DL, KA], labels),
      "Ships from Delhi, Karnataka and Tamil Nadu"
    )
  })

  it("counts duplicate codes once", () => {
    assert.equal(
      buildShipFromText([KA, KA, KA], labels),
      "Ships from Karnataka"
    )
    assert.equal(
      buildShipFromText([KA, MH, KA, MH, TN, TN, DL], labels),
      "Ships from multiple states"
    )
  })

  it("uses the labels it is given, not fixed English", () => {
    const custom = {
      shipFrom: (statesText: string) => `From: ${statesText}`,
      multiple: "From many",
      and: "&",
    }
    assert.equal(buildShipFromText([KA, MH], custom), "From: Karnataka & Maharashtra")
    assert.equal(buildShipFromText([KA, MH, TN, DL], custom), "From many")
  })

  it("ignores entries without a code or a name", () => {
    assert.equal(
      buildShipFromText([state("", "Nowhere"), state("IN-KA", ""), KA], labels),
      "Ships from Karnataka"
    )
  })
})
