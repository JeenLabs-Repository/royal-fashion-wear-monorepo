import { locales } from "@i18n/config"
import {
  revalidatePath,
  revalidateTag,
  unstable_expireTag,
} from "next/cache"
import { type NextRequest, NextResponse } from "next/server"

// Route-file patterns (with the `(main)` group) plus the public URL layouts.
// Next 15.5 matches cache entries by route file structure; URL layouts cover
// every product/store page under each locale when a suspension or publish lands.
const revalidateCatalogPaths = () => {
  revalidatePath(`/[locale]/(main)/products/[handle]`, "page")
  revalidatePath(`/[locale]/(main)/store`, "page")
  revalidatePath(`/[locale]/(main)/categories/[...category]`, "page")
  revalidatePath(`/[locale]/(main)/collections/[handle]`, "page")
  for (const locale of locales) {
    revalidatePath(`/${locale}/products`, "layout")
    revalidatePath(`/${locale}/store`, "layout")
    revalidatePath(`/${locale}/categories`, "layout")
    revalidatePath(`/${locale}/collections`, "layout")
  }
  revalidatePath("/llms.txt")
  revalidatePath("/sitemap.xml")
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET
  const secret = req.headers.get("x-revalidate-secret")

  // Fail closed: with no secret configured nobody gets in, instead of everybody.
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { type?: string } | null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (
    body.type === "product.updated" ||
    body.type === "product.created" ||
    body.type === "product.deleted" ||
    body.type === "product-variant.updated" ||
    body.type === "product-variant.created" ||
    body.type === "product-variant.deleted" ||
    body.type === "product-tag.updated" ||
    body.type === "product-tag.created" ||
    body.type === "product-tag.deleted" ||
    body.type === "product-option.updated" ||
    body.type === "product-option.created" ||
    body.type === "product-option.deleted"
  ) {
    revalidateTag("products")
    // expireTag updates the tag stamp every time; revalidateTag alone can leave
    // a long-lived next-server serving the first force-cached catalog fetch.
    unstable_expireTag("products")
    revalidateCatalogPaths()
  }

  if (
    body.type === "product-category.updated" ||
    body.type === "product-category.created" ||
    body.type === "product-category.deleted"
  ) {
    revalidateTag("categories")
    unstable_expireTag("categories")
    revalidateCatalogPaths()
  }

  if (
    body.type === "product-collection.updated" ||
    body.type === "product-collection.created" ||
    body.type === "product-collection.deleted"
  ) {
    revalidateTag("collections")
    unstable_expireTag("collections")
    revalidatePath(`/[locale]/(main)/collections/[handle]`, "page")
    revalidatePath(`/[locale]/(main)/store`, "page")
    for (const locale of locales) {
      revalidatePath(`/${locale}/collections`, "layout")
      revalidatePath(`/${locale}/store`, "layout")
    }
    revalidatePath("/llms.txt")
    revalidatePath("/sitemap.xml")
  }

  if (
    body.type === "translation.created" ||
    body.type === "translation.updated" ||
    body.type === "translation.deleted"
  ) {
    revalidateTag("products")
    revalidateTag("categories")
    revalidateTag("collections")
    unstable_expireTag("products", "categories", "collections")
    revalidateCatalogPaths()
  }

  return NextResponse.json({ revalidated: true })
}
