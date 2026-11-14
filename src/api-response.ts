export async function readApiResponse<T>(response: Response): Promise<T> {
  let result: any;
  try {
    result = await response.json();
  } catch {
    // A proxy or an older server can return an HTML error page instead of JSON.
    throw new Error(
      "The app received an unexpected response. Refresh the page and try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : "Something went wrong. Please try again.",
    );
  return result;
}
