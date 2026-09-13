import type { ClientAnalyticsSnapshot } from "@central-vet/db";
import { Clock3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  analyticsMinutes,
  waitTimeChartData
} from "./adminAnalyticsModel";

const chartConfig = {
  median: {
    label: "Median minutes",
    color: "var(--chart-1)"
  },
  p90: {
    label: "90th percentile",
    color: "var(--chart-3)"
  }
} satisfies ChartConfig;

export function AdminWaitTimeAnalytics({
  stages
}: {
  stages: ClientAnalyticsSnapshot["waitStages"];
}) {
  const chartData = waitTimeChartData(stages);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where clients wait</CardTitle>
        <CardDescription>
          Median shows the typical visit. The 90th percentile exposes the longest waits.
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            <Clock3 data-icon="inline-start" />
            Minutes
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {chartData.length > 0 ? (
          <ChartContainer className="h-72 w-full" config={chartConfig}>
            <BarChart accessibilityLayer data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="stage"
                tickLine={false}
                tickMargin={8}
                tickFormatter={(value) => String(value).replace(" to ", " → ")}
              />
              <YAxis axisLine={false} tickLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
              <Bar dataKey="median" fill="var(--color-median)" radius={4} />
              <Bar dataKey="p90" fill="var(--color-p90)" radius={4} />
            </BarChart>
          </ChartContainer>
        ) : (
          <Alert>
            <Clock3 />
            <AlertTitle>Wait-time collection has started</AlertTitle>
            <AlertDescription>
              Each stage appears after a visit records both its start and end timestamp.
            </AlertDescription>
          </Alert>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Median</TableHead>
              <TableHead>90th</TableHead>
              <TableHead>Visits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => (
              <TableRow key={stage.key}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{stage.label}</span>
                    <span className="text-xs text-muted-foreground">{stage.description}</span>
                  </div>
                </TableCell>
                <TableCell>{analyticsMinutes(stage.medianMinutes)}</TableCell>
                <TableCell>{analyticsMinutes(stage.p90Minutes)}</TableCell>
                <TableCell>{stage.sampleSize}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
