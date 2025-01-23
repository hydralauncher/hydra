import type { Meta, StoryObj } from "@storybook/react";
import { Toast } from "@renderer/components";
import { useState } from "react";

const meta = {
  title: "Components/Toast",
  component: Toast,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof Toast>;

// Base stories for each variant
export const Success: Story = {
  args: {
    visible: true,
    message: "Operation completed successfully",
    type: "success",
    onClose: () => {},
  },
};

export const Error: Story = {
  args: {
    visible: true,
    message: "An error occurred",
    type: "error",
    onClose: () => {},
  },
};

export const Warning: Story = {
  args: {
    visible: true,
    message: "Please review before proceeding",
    type: "warning",
    onClose: () => {},
  },
};

// Interactive story with toggle functionality
const InteractiveToastTemplate = () => {
  const [visible, setVisible] = useState(true);

  return (
    <div style={{ padding: "20px" }}>
      <button onClick={() => setVisible(true)} style={{ marginBottom: "20px" }}>
        Show Toast
      </button>

      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          maxWidth: "420px",
          width: "420px",
        }}
      >
        <Toast
          visible={visible}
          message="This is an interactive toast"
          type="success"
          onClose={() => setVisible(false)}
        />
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveToastTemplate />,
};

// Long message example
export const LongMessage: Story = {
  args: {
    visible: true,
    message:
      "This is a very long message that demonstrates how the toast component handles text wrapping and content overflow in cases where the message is extensive",
    type: "success",
    onClose: () => {},
  },
};

// Story with auto-close behavior
const AutoCloseToastTemplate = () => {
  const [visible, setVisible] = useState(true);

  return (
    <div style={{ padding: "20px" }}>
      <button
        onClick={() => setVisible(true)}
        style={{ marginBottom: "20px" }}
        disabled={visible}
      >
        Show Toast Again
      </button>
      <Toast
        visible={visible}
        message="This toast will auto-close in 2.5 seconds"
        type="success"
        onClose={() => setVisible(false)}
      />
    </div>
  );
};

export const AutoClose: Story = {
  render: () => <AutoCloseToastTemplate />,
};
