import { Suspense } from "react";
import CalendarScreen from "@/components/CalendarScreen";

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarScreen />
    </Suspense>
  );
}
