import { Category, Import, Setting2, Home2, Book } from "iconsax-reactjs";

export const routes = [
  {
    path: "/",
    nameKey: "home",
    render: () => <Home2 size={16} />,
  },
  {
    path: "/catalogue",
    nameKey: "catalogue",
    render: () => <Category size={16} />,
  },
  {
    path: "/library",
    nameKey: "library",
    render: () => <Book size={16} />,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    render: () => <Import size={16} />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <Setting2 size={16} />,
  },
];
