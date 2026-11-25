import { Button, Heading, Text } from "@medusajs/ui"
import { useState } from "react"
import { StatusBanner } from "../StatusBanner"
import { errorText, toApiError } from "../../lib/errors"
import {
  FILE_TOO_LARGE_MESSAGE,
  type ImportResult,
  MAX_FILE_BYTES,
  downloadExport,
  downloadTemplate,
  fileMessage,
  rowMessage,
  useImportCsv,
} from "../../lib/api/inventory"

const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1_048_576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1_048_576).toFixed(2)} MB`

export const CsvImportPanel = () => {
  const importer = useImportCsv()
  const [file, setFile] = useState<File | null>(null)
  const [wholeFileMessage, setWholeFileMessage] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const choose = (selected: File | null) => {
    setResult(null)
    setWholeFileMessage(null)
    if (selected && selected.size > MAX_FILE_BYTES) {
      // A convenience only. The server enforces the limit again.
      setFile(null)
      setWholeFileMessage(FILE_TOO_LARGE_MESSAGE)
      return
    }
    setFile(selected)
  }

  const upload = async () => {
    if (!file) return
    setResult(null)
    setWholeFileMessage(null)
    try {
      setResult(await importer.mutateAsync(file))
    } catch (error) {
      const failure = toApiError(error)
      setWholeFileMessage(fileMessage(failure.code) ?? errorText(error))
    }
  }

  const download = async (action: () => Promise<void>) => {
    setDownloadError(null)
    try {
      await action()
    } catch (error) {
      setDownloadError(errorText(error))
    }
  }

  return (
    <section className="flex flex-col gap-y-3" aria-labelledby="csv-heading" data-testid="csv-panel">
      <Heading level="h2" id="csv-heading">
        Update stock from a CSV file
      </Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Download the template, fill in one row for each SKU and location, and upload it. Rows that
        fail do not stop the other rows, and you can upload the same file again safely.
      </Text>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => download(downloadTemplate)}>
          Download template
        </Button>
        <Button variant="secondary" onClick={() => download(downloadExport)}>
          Download current stock
        </Button>
      </div>
      {downloadError && <StatusBanner tone="error">{downloadError}</StatusBanner>}

      <div className="flex flex-col gap-y-1">
        <label htmlFor="csv-file" className="txt-small-plus">
          CSV file
        </label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          data-testid="csv-file"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
        {file && (
          <Text size="small" className="text-ui-fg-subtle" data-testid="csv-file-size">
            {`${file.name}, ${formatBytes(file.size)}`}
          </Text>
        )}
      </div>

      <div>
        <Button onClick={upload} disabled={!file || importer.isPending} isLoading={importer.isPending}>
          Upload
        </Button>
      </div>

      {wholeFileMessage && (
        <StatusBanner tone="error">
          <span data-testid="csv-file-error">{wholeFileMessage}</span> Nothing was changed.
        </StatusBanner>
      )}

      {result && (
        <div className="flex flex-col gap-y-2" data-testid="csv-result">
          <div className="flex gap-x-4">
            <Text weight="plus" data-testid="csv-applied">{`Applied ${result.applied}`}</Text>
            <Text weight="plus" data-testid="csv-failed">{`Failed ${result.failed}`}</Text>
          </div>
          {result.errors.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-ui-border-base">
              <table className="w-full min-w-[480px] text-left" data-testid="csv-errors">
                <thead className="bg-ui-bg-subtle">
                  <tr>
                    <th scope="col" className="txt-small-plus px-3 py-2">
                      Row
                    </th>
                    <th scope="col" className="txt-small-plus px-3 py-2">
                      SKU
                    </th>
                    <th scope="col" className="txt-small-plus px-3 py-2">
                      Location
                    </th>
                    <th scope="col" className="txt-small-plus px-3 py-2">
                      Problem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((entry, index) => (
                    <tr key={`${entry.row}-${index}`} className="border-t border-ui-border-base">
                      <td className="px-3 py-2">{entry.row}</td>
                      <td className="px-3 py-2">{entry.sku ?? ""}</td>
                      <td className="px-3 py-2">{entry.location_code ?? ""}</td>
                      <td className="px-3 py-2" data-code={entry.code}>
                        {rowMessage(entry.code)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.failed > result.errors.length && (
            <Text size="small" className="text-ui-fg-subtle">
              {`Showing the first ${result.errors.length} of ${result.failed} errors.`}
            </Text>
          )}
        </div>
      )}
    </section>
  )
}
