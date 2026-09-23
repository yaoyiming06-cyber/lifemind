declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

  type LucideIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
    size?: number | string;
    absoluteStrokeWidth?: boolean;
  };

  const Icon: ForwardRefExoticComponent<LucideIconProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
