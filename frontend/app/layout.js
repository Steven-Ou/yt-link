// app/layout.js

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import UpdateStatus from "./components/UpdateStatus"; // Make sure this path is correct

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// You might want to update this metadata to better describe your application
export const metadata = {
  title: "YT Link V2", // Updated title
  description: "A desktop app for downloading YouTube audio.", // Updated description
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        // This keeps your Geist font variables and antialiased styling
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* This renders your page content (e.g., page.js) */}
        {children}
        
        {/* This adds the global component to handle and display app update status */}
        <UpdateStatus />
      </body>
    </html>
  );
}