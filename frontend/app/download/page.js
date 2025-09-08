"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import UpdateStatus from "../components/UpdateStatus";

function DownloadPageContent() {
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
}
