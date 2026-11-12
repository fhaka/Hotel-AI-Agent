import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="py-16 text-center">
      <Spinner label="Loading" />
    </div>
  );
}
