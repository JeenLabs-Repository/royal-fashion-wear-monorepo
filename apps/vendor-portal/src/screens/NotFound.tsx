import { Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { AuthFrame } from "../components/Shell"

export const NotFound = () => (
  <AuthFrame title="Page not found">
    <Heading level="h2" className="sr-only">
      Page not found
    </Heading>
    <Text className="text-ui-fg-subtle">The page you opened does not exist.</Text>
    <Link to="/" className="text-ui-fg-interactive txt-small-plus">
      Go to the portal home
    </Link>
  </AuthFrame>
)
