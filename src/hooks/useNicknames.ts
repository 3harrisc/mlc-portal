"use client";

import { useEffect, useState } from "react";
import { fetchNicknames } from "@/lib/postcode-nicknames";

/** Hook to load postcode nicknames. Returns a map of normalized postcode → nickname. */
export function useNicknames(): Record<string, string> {
  const [nicknames, setNicknames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchNicknames().then(setNicknames);
  }, []);

  return nicknames;
}
