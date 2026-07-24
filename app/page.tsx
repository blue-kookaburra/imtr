import { Suspense } from "react";
import MapScreen from "@/components/MapScreen";

export default function Home() {
  return (
    <Suspense>
      <MapScreen />
    </Suspense>
  );
}
