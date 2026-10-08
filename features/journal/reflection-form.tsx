"use client";

import {useSyncExternalStore,type ComponentProps,type ReactNode} from "react";
import {useFormStatus} from "react-dom";

const subscribe=()=>()=>{};
const clientReady=()=>true;
const serverReady=()=>false;

function ReflectionFields({children}:{children:ReactNode}) {
  const ready=useSyncExternalStore(subscribe,clientReady,serverReady);
  const {pending}=useFormStatus();
  return <fieldset className="contents" disabled={!ready || pending} aria-busy={!ready || pending} data-journal-ready={ready}>
    {children}
  </fieldset>;
}

/** Protect edits from initial hydration reset; pending submits are also locked. */
export function ReflectionForm({children,...props}:ComponentProps<"form">) {
  return <form {...props}><ReflectionFields>{children}</ReflectionFields></form>;
}
