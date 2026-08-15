"use client";

import { useRouter } from "next/navigation";

import { ArrowBackIcon } from "@/components/icons";

export default function BackButton() {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/"); // Redirect to home if no history
    }
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={goBack}
      aria-label="Go back"
      title="Go back"
    >
      <ArrowBackIcon />
    </button>
  );
}
