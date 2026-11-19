"use client";

import { useEffect } from "react";
import { installRendererLogCapture } from "@/lib/log/client";

export function DiagnosticsBoot() {
  useEffect(() => { installRendererLogCapture(); }, []);
  return null;
}
