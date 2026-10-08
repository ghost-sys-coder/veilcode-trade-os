import { randomUUID } from "node:crypto";

/** Server-rendered once per form; identical resubmissions retain the operation ID. */
export function OperationFields({expectedVersion}:{expectedVersion?:string}) {
  return <><input type="hidden" name="operationId" value={randomUUID()} />
    {expectedVersion?<input type="hidden" name="expectedVersion" value={expectedVersion} />:null}</>;
}
