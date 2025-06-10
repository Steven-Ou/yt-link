// app/layout.js

import { Inter } from "next/font/google";
import "./globals.css";
import UpdateStatus from "./components/UpdateStatus"; // Adjust path if you created it elsewhere

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "YT Link V2", // Or your app's name
  description: "Your application description",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Your other layout components (like a Navbar, ThemeProvider, etc.) can go here */}
        
        {children} {/* This renders your pages (like page.js) */}
        
        {/* Add the UpdateStatus component here */}
        <UpdateStatus />
        
      </body>
    </html>
  );
}