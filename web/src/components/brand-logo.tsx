import Image from "next/image";
import { cn } from "@/lib/utils";

export const PRODUCT_NAME = "CoTravel";

const LOCKUP = { src: "/brand/cotravel.png", width: 447, height: 374 };
const MARK = { src: "/brand/cotravel-mark.png", width: 248, height: 245 };
const WORDMARK = { src: "/brand/cotravel-wordmark.png", width: 435, height: 93 };

type BrandLogoProps = {
  /** Stacked mark, name, and tagline. Horizontal is the mark beside the name. */
  layout?: "lockup" | "horizontal";
  className?: string;
  priority?: boolean;
};

/** App logo. `className` sets the rendered height; width follows the artwork. */
export function BrandLogo({ layout = "horizontal", className, priority = false }: BrandLogoProps) {
  if (layout === "lockup") {
    return (
      <Image
        src={LOCKUP.src}
        alt={PRODUCT_NAME}
        width={LOCKUP.width}
        height={LOCKUP.height}
        priority={priority}
        className={cn("w-auto", className ?? "h-28")}
        style={{ width: "auto" }}
      />
    );
  }

  return (
    <span role="img" aria-label={PRODUCT_NAME} className={cn("inline-flex items-center gap-2", className ?? "h-9")}>
      <Image
        src={MARK.src}
        alt=""
        width={MARK.width}
        height={MARK.height}
        priority={priority}
        className="h-full w-auto"
        style={{ width: "auto" }}
      />
      <Image
        src={WORDMARK.src}
        alt=""
        width={WORDMARK.width}
        height={WORDMARK.height}
        priority={priority}
        className="h-[58%] w-auto"
        style={{ width: "auto" }}
      />
    </span>
  );
}
