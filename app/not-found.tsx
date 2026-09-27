import Link from "next/link";
export default function NotFound() {
  return (<><h1>Not found</h1><p className="sub">That stock is not in the India or US universe.</p><Link href="/scan" className="btn">Back to the scanner</Link></>);
}
