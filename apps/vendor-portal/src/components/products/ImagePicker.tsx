import { Button, Text } from "@medusajs/ui"
import { useRef, useState } from "react"
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  type ImageItem,
  checkImageFile,
  uploadErrorText,
  uploadImage,
} from "../../lib/api/uploads"

type Note = { key: string; name: string; status: "uploading" | "error"; text: string }

type ImagePickerProps = {
  value: ImageItem[]
  onChange: (items: ImageItem[]) => void
  error?: string
  disabled?: boolean
}

// Shows the uploaded images in order, uploads new ones one request at a time,
// and reports the ordered list. Names and URLs are rendered as text and as an
// image source only, never as markup.
export const ImagePicker = ({ value, onChange, error, disabled = false }: ImagePickerProps) => {
  const [notes, setNotes] = useState<Note[]>([])
  const [busy, setBusy] = useState(false)
  const locked = disabled || busy
  const latest = useRef(value)
  latest.current = value

  const publish = (items: ImageItem[]) => {
    latest.current = items
    onChange(items)
  }

  const setNote = (note: Note) =>
    setNotes((current) => [...current.filter((entry) => entry.key !== note.key), note])
  const dropNote = (key: string) => setNotes((current) => current.filter((entry) => entry.key !== key))

  const addFiles = async (files: File[]) => {
    setBusy(true)
    setNotes([])
    const room = Math.max(MAX_IMAGES - latest.current.length, 0)
    const accepted = files.slice(0, room)
    if (files.length > accepted.length) {
      setNote({
        key: "limit",
        name: "",
        status: "error",
        text: `A product holds at most ${MAX_IMAGES} images. ${files.length - accepted.length} not added.`,
      })
    }

    for (const [index, file] of accepted.entries()) {
      const key = `${index}-${file.name}-${file.size}`
      const local = checkImageFile(file)
      if (local) {
        setNote({ key, name: file.name, status: "error", text: local })
        continue
      }
      setNote({ key, name: file.name, status: "uploading", text: "Uploading" })
      try {
        const uploaded = await uploadImage(file, (fraction) =>
          setNote({ key, name: file.name, status: "uploading", text: `Uploading ${Math.round(fraction * 100)}%` })
        )
        publish([...latest.current, uploaded])
        dropNote(key)
      } catch (failure) {
        setNote({ key, name: file.name, status: "error", text: uploadErrorText(failure) })
      }
    }
    setBusy(false)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= latest.current.length) return
    const next = [...latest.current]
    ;[next[index], next[target]] = [next[target], next[index]]
    publish(next)
  }

  const remove = (index: number) => publish(latest.current.filter((_, position) => position !== index))

  const full = value.length >= MAX_IMAGES

  return (
    <div className="flex flex-col gap-y-3" data-testid="image-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="small" className="text-ui-fg-subtle" data-testid="image-count">
          {value.length} of {MAX_IMAGES}
        </Text>
        <label htmlFor="product-images" className="sr-only">
          Add images
        </label>
        <input
          id="product-images"
          type="file"
          multiple
          accept={IMAGE_TYPES.join(",")}
          disabled={full || locked}
          aria-label="Add images"
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (files.length > 0) void addFiles(files)
          }}
        />
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={full || locked}
          onClick={() => document.getElementById("product-images")?.click()}
        >
          Add images
        </Button>
      </div>

      {value.length > 0 && (
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {value.map((image, index) => (
            <li
              key={image.upload_id}
              className="flex items-center gap-3 rounded-md bg-ui-bg-base p-2 shadow-elevation-card-rest"
            >
              <img
                src={image.url}
                alt={`Product image ${index + 1}`}
                className="size-16 shrink-0 rounded object-cover"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={locked || index === 0}
                  aria-label={`Move image ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={locked || index === value.length - 1}
                  aria-label={`Move image ${index + 1} down`}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={locked}
                  aria-label={`Remove image ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {notes.map((note) => (
        <Text
          key={note.key}
          size="small"
          role={note.status === "error" ? "alert" : "status"}
          className={note.status === "error" ? "text-ui-fg-error" : "text-ui-fg-subtle"}
        >
          {note.name ? `${note.name}: ` : ""}
          {note.text}
        </Text>
      ))}

      {error && (
        <Text size="small" className="text-ui-fg-error" data-field-error="true" data-testid="error-images">
          {error}
        </Text>
      )}
    </div>
  )
}
