import { Typography } from "..";

interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  title: string;
  value: string;
}

function Box({
  children,
  ...props
}: Readonly<Omit<BoxProps, "title" | "value">>) {
  const { style, ...rest } = props;

  return (
    <div
      style={{
        backgroundColor: "#0E0E0E",
        padding: 8,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function TitleBox({ title }: Readonly<Omit<BoxProps, "value">>) {
  return (
    <Box>
      <Typography
        style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.5)" }}
      >
        {title}
      </Typography>
    </Box>
  );
}

function SingleLineBox({ title, value }: Readonly<BoxProps>) {
  return (
    <Box style={{ display: "flex", justifyContent: "space-between" }}>
      <Typography style={{ color: "rgba(255, 255, 255, 0.5)" }}>
        {title}
      </Typography>
      <Typography style={{ fontWeight: "700" }}>{value}</Typography>
    </Box>
  );
}

export { Box, TitleBox, SingleLineBox };
