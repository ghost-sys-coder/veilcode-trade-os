import { handleMcpRequest } from "@/services/mcp/handle-request";

export const runtime="nodejs";
export const POST=handleMcpRequest;
export const GET=handleMcpRequest;
export const DELETE=handleMcpRequest;
