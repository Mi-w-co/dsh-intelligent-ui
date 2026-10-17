/**
 * The OpenUI component library for DSH.
 *
 * This is the official `thesysdev/open-intelligent-ui` library: the components,
 * @functions and actions under `./lib/` are that project's own source, kept as
 * close to upstream as the build allows so the model's prompt and the renderer
 * stay in the shape they were designed for. The only additions here are the
 * exports DSH needs.
 */
import { createLibrary } from "@openuidev/react-lang";
import { actions } from "./lib/actions";
// Imported as text (see the esbuild loader) and inserted into the document at
// activation: a client bundle cannot emit a <link>, and a bare `import "./x.css"`
// is dropped by the bundler because the file has no declared side effects.
import themeCss from "./lib/components/theme.css";
import componentsCss from "./lib/components/components.css";
import mapCss from "./lib/components/map/map.css";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css";
import { Chart } from "./lib/components/chart";
import { Carousel, Celebration, Code, Flashcard, MathBlock, Popover, Quote, YouTube, katexCss } from "./lib/components/extra";
import {
  Button,
  Checkbox,
  DatePicker,
  IconButton,
  Input,
  Pressable,
  RadioGroup,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  Timer,
} from "./lib/components/controls";
import { HtmlView } from "./lib/components/html-view";
import { Box, Card, Col, Divider, Form, Grid, Row, Spacer } from "./lib/components/layout";
import { MapMarker, MapView } from "./lib/components/map/map";
import { Icon, Image, SearchImage } from "./lib/components/media";
import { svgComponents } from "./lib/components/svg";
import { Table } from "./lib/components/table";
import { Badge, Caption, Label, Link, List, ListItem, Markdown, Text, Title } from "./lib/components/text";
import { functions } from "./lib/functions";

/**
 * Primitives the model arranges itself, plus widgets for what a model cannot
 * draw (a street map, a sandboxed HTML page). Layout is never fixed here.
 */
export const library = createLibrary({
  root: "Col",
  components: [
    Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer,
    Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, MathBlock,
    Button, IconButton, Pressable, Input, TextArea, Select, SegmentedControl, Slider, Checkbox,
    RadioGroup, DatePicker, Timer, Form,
    SearchImage, Image, Icon, Table, Chart, MapView, MapMarker, YouTube,
    Flashcard, Celebration,
    ...svgComponents, HtmlView,
  ],
  functions,
  actions,
  componentGroups: [
    {
      name: "Layout",
      components: ["Col", "Row", "Box", "Grid", "Card", "Carousel", "Popover", "Divider", "Spacer"],
      notes: [
        '- gap and padding count 4px steps. Length is px or a CSS length like "50%". Radius is "sm", "md", "lg", "xl", "full" or px.',
        '- Color is "ink", "muted", "faint", "surface", "info", "success", "warning", "danger", "purple", "pink", "chart1" to "chart6", or a CSS color. As a background, status colors are soft tints.',
      ],
    },
    { name: "Text", components: ["Title", "Text", "Caption", "Label", "Badge", "Link", "List", "ListItem", "Markdown", "Quote", "Code", "Math"] },
    {
      name: "Inputs",
      components: ["Button", "IconButton", "Pressable", "Input", "TextArea", "Select", "SegmentedControl", "Slider", "Checkbox", "RadioGroup", "DatePicker", "Timer", "Form"],
      notes: [
        "- An input's first argument is its value, usually a $variable that other statements read.",
        '- Every input either changes something shown on the page, or sits in a Form whose submit Button sends a short first-person @ToAssistant ("Help me choose a bike"); the form values go with it. No dead inputs.',
      ],
    },
    { name: "Media and data", components: ["SearchImage", "Image", "Icon", "Table", "Chart", "Map", "MapMarker", "YouTube"] },
    { name: "Play", components: ["Flashcard", "Celebration"] },
    { name: "Drawing", components: ["Svg", "G", "Circle", "Ellipse", "Rect", "Line", "Path", "Polyline", "Polygon", "SvgText", "HtmlView"] },
  ],
});

export { promptOptions } from "./lib/prompt-options";
export { runLibraryAction } from "./lib/actions";

/** The library's own stylesheets, for the client half to insert at activation. */
export const componentCss = `${themeCss}\n${componentsCss}\n${mapCss}\n${maplibreCss}\n${katexCss}`;
