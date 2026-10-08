"use client";

import {useSyncExternalStore,type ComponentProps,type ReactNode} from "react";
import {useFormStatus} from "react-dom";

const subscribe=()=>()=>{};
const clientReady=()=>true;
const serverReady=()=>false;
function MutationFields({children}:{children:ReactNode}) {
  const ready=useSyncExternalStore(subscribe,clientReady,serverReady);
  const {pending}=useFormStatus();
  return <fieldset className="contents" disabled={!ready || pending} aria-busy={!ready || pending} data-mutation-ready={ready} data-journal-ready={ready}>{children}</fieldset>;
}
/** Prevent hydration resets from losing edits and lock pending submissions. */
export function MutationForm({children,...props}:ComponentProps<"form">) {
  return <form {...props}><MutationFields>{children}</MutationFields></form>;
}
