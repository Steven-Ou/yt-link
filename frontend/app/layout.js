// frontend/app/layout.js

import "./globals.css";
import UpdateStatus from "./components/UpdateStatus";

// You can update this metadata as you see fit
export const metadata = {
  title: "YT Link V2",
  description: "Download audio from your favorite videos.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* We now import the fonts directly using standard link tags to resolve the build conflict. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist+Sans:wght@400;500;700&family=Geist+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* We will apply the font via a class in globals.css now */}
      <body className="font-sans antialiased">
        {children}
        <UpdateStatus />
      </body>
    </html>
  );
}