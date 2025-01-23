import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@renderer/components";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof Button>;

// Primary button (default)
export const Primary: Story = {
  args: {
    children: "Primary Button",
    theme: "primary",
  },
};

// Outline variant
export const Outline: Story = {
  args: {
    children: "Outline Button",
    theme: "outline",
  },
};

// Dark variant
export const Dark: Story = {
  args: {
    children: "Dark Button",
    theme: "dark",
  },
};

// Danger variant
export const Danger: Story = {
  args: {
    children: "Danger Button",
    theme: "danger",
  },
};

// Disabled state
export const Disabled: Story = {
  args: {
    children: "Disabled Button",
    disabled: true,
  },
};

// Button with icon example
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <span>🚀</span>
        <span>Button with Icon</span>
      </>
    ),
  },
};

// Different sizes example using className
export const CustomClassName: Story = {
  args: {
    children: "Custom Class Button",
    className: "custom-class",
  },
};
