import { describe, expect, it } from "vitest";
import { FAMILY_META, FAMILY_ORDER, familyOf } from "./denomination";

describe("familyOf", () => {
  it("maps common OSM denomination values", () => {
    expect(familyOf("catholic")).toBe("catholic");
    expect(familyOf("roman_catholic")).toBe("catholic");
    expect(familyOf("russian_orthodox")).toBe("orthodox");
    expect(familyOf("seventh_day_adventist")).toBe("adventist");
    expect(familyOf("jehovahs_witness")).toBe("restorationist");
    expect(familyOf("southern_baptist")).toBe("baptist");
    expect(familyOf("anglican")).toBe("anglican");
    expect(familyOf("presbyterian")).toBe("protestant");
  });

  it("maps Wikidata labels too", () => {
    expect(familyOf("Catholicism")).toBe("catholic");
    expect(familyOf("Eastern Orthodoxy")).toBe("orthodox");
    expect(familyOf("Armenian Apostolic Church")).toBe("orthodox");
    expect(familyOf("Anglicanism")).toBe("anglican");
    expect(familyOf("Lutheranism")).toBe("protestant");
  });

  it("treats evangelical as a modifier, not a family, when a tradition is named", () => {
    expect(familyOf("evangelical_lutheran")).toBe("protestant");
    expect(familyOf("Evangelical Presbyterian")).toBe("protestant");
    expect(familyOf("evangelical")).toBe("evangelical");
    expect(familyOf("assemblies_of_god")).toBe("evangelical");
  });

  it("falls back to other", () => {
    expect(familyOf(undefined)).toBe("other");
    expect(familyOf("")).toBe("other");
    expect(familyOf("unitarian")).toBe("other");
  });

  it("has a colour and label for every family", () => {
    for (const family of FAMILY_ORDER) {
      expect(FAMILY_META[family].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(FAMILY_META[family].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FAMILY_META).sort()).toEqual([...FAMILY_ORDER].sort());
  });
});
