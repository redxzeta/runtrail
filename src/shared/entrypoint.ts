import { pathToFileURL } from "node:url";

/** Compare Node's canonical file URL, including platform paths and URL escaping. */
export function isMainModule(
  moduleUrl: string,
  argvPath: string | undefined = process.argv[1],
  options?: { windows?: boolean }
): boolean {
  return Boolean(argvPath && moduleUrl === pathToFileURL(argvPath, options).href);
}
