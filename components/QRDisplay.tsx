"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { ArrowUpRight, QrCode, Smartphone } from "lucide-react";

export function QRDisplay() {
  const [qr, setQR] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const voteUrl = `${appUrl}/vote`;
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(voteUrl, { width: 720, margin: 3, errorCorrectionLevel: "M", color: { dark: "#11131c", light: "#ffffff" } })
      .then((value) => { if (active) setQR(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [voteUrl]);
  return <div className="qr-panel"><div className="qr-panel-top"><span className="qr-panel-icon"><Smartphone size={19} /></span><span>YOUR PHONE IS YOUR BALLOT</span><ArrowUpRight size={18} /></div><div className="qr-white">{qr ? <Image unoptimized src={qr} alt={`Scan this QR code to vote at ${voteUrl}`} width={720} height={720} priority /> : <div className="qr-placeholder"><QrCode size={58} /><span>{error ? "Use the link below to vote" : "Preparing QR code…"}</span></div>}</div><div className="qr-caption"><span>Point your camera. Make your choice.</span><a href={voteUrl}>{voteUrl.replace(/^https?:\/\//, "")} <ArrowUpRight size={13} /></a></div></div>;
}
