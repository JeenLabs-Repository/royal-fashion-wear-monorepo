import { type Finding, scanText } from "./scan";
import {
  type Surface,
  type SurfaceContext,
  type SurfaceResponse,
  markExercised,
} from "./surfaces/registry";

export type RunResult = {
  surfaceId: string;
  requests: number;
  failures: string[];
  findings: (Finding & { url: string })[];
};

const bodyText = (response: SurfaceResponse, kind: Surface["kind"]): string => {
  if (typeof response.body === "string") {
    return response.body;
  }
  // Image bytes are read as latin1 so embedded text (EXIF fields) stays searchable.
  return response.body.toString(kind === "image" ? "latin1" : "utf8");
};

export const runSurface = async (surface: Surface, context: SurfaceContext): Promise<RunResult> => {
  const result: RunResult = { surfaceId: surface.id, requests: 0, failures: [], findings: [] };

  let responses: SurfaceResponse[] = [];
  try {
    responses = await surface.collect(context);
  } catch (error) {
    result.failures.push(`collect failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const response of responses) {
    result.requests += 1;
    if (response.status >= 500) {
      result.failures.push(`${response.url} returned ${response.status}`);
    }
    for (const finding of scanText(bodyText(response, surface.kind), response.url)) {
      result.findings.push({ ...finding, url: response.url });
    }
  }

  markExercised(surface.id, result.requests);
  return result;
};
