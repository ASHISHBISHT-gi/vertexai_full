// Demo transcripts in WebVTT format (the timestamps are what lets the AI tutor say WHERE in a video an answer is).
// course title -> lecture title -> transcript
export const DEMO_TRANSCRIPTS: Record<string, Record<string, string>> = {
  "SQL for Beginners": {
    "SELECT and WHERE": `WEBVTT

00:00:00.000 --> 00:00:22.000
Welcome. In this lecture we learn the two most important parts of a query: SELECT and WHERE. SELECT chooses which columns you want back, and FROM says which table to read. For example, SELECT name, salary FROM employees returns just those two columns for every employee.

00:00:22.000 --> 00:00:50.000
Avoid SELECT star in real applications. It returns every column, which is slower and breaks your code when someone adds a column later. Name the columns you need.

00:00:50.000 --> 00:01:20.000
Now WHERE. The WHERE clause filters rows before anything else happens. WHERE salary greater than 50000 keeps only the employees who earn more than fifty thousand. You can use equals, not equals, greater than, less than, and combine conditions with AND and OR.

00:01:20.000 --> 00:01:50.000
Use LIKE for pattern matching: WHERE name LIKE 'A%' finds names starting with A. To test for missing values you must write IS NULL. Writing equals NULL never works, because NULL means unknown, and unknown is never equal to anything.`,

    "Sorting and limiting": `WEBVTT

00:00:00.000 --> 00:00:25.000
By default SQL returns rows in no guaranteed order. To control the order use ORDER BY. ORDER BY salary DESC puts the highest salary first; ASC, the default, sorts from lowest to highest.

00:00:25.000 --> 00:00:55.000
You can sort by several columns. ORDER BY department, salary DESC sorts by department first, and inside each department the highest salary comes first.

00:00:55.000 --> 00:01:25.000
LIMIT restricts how many rows come back. ORDER BY salary DESC LIMIT 3 gives the three best paid employees. Combine LIMIT with OFFSET to build pages: LIMIT 10 OFFSET 20 skips the first twenty rows and returns the next ten.

00:01:25.000 --> 00:01:55.000
SELECT DISTINCT removes duplicate rows from the result. SELECT DISTINCT department FROM employees lists each department only once, no matter how many employees it has.`,

    "INNER JOIN": `WEBVTT

00:00:00.000 --> 00:00:28.000
Real databases split data across tables. Employees live in one table and departments in another. A JOIN combines them. An INNER JOIN returns only the rows that have a match in both tables.

00:00:28.000 --> 00:01:00.000
You say which columns match with ON. SELECT e.name, d.name FROM employees e INNER JOIN departments d ON e.department_id = d.id. The letters e and d are aliases, short names for the tables that keep the query readable.

00:01:00.000 --> 00:01:30.000
Notice that an employee with no department is missing from an INNER JOIN result, because there is nothing to match. Also never forget the ON condition. Without it every employee is paired with every department, which is called a cross product and produces a huge, wrong result.`,

    "LEFT JOIN": `WEBVTT

00:00:00.000 --> 00:00:30.000
A LEFT JOIN keeps every row from the left table, the one written before the word JOIN, even when there is no match on the right. Where there is no match, the right side columns come back as NULL.

00:00:30.000 --> 00:01:05.000
So SELECT e.name, d.name FROM employees e LEFT JOIN departments d ON e.department_id = d.id lists all employees. Those without a department simply show NULL for the department name.

00:01:05.000 --> 00:01:40.000
A very useful trick: to find rows that have no match, LEFT JOIN and then filter with WHERE d.id IS NULL. That returns, for example, every employee who is not assigned to any department. The difference to remember: INNER JOIN drops unmatched rows, LEFT JOIN keeps them.`,
  },
  "Data Structures & Algorithms in JavaScript": {
    "Bubble and Selection Sort": `WEBVTT

00:00:00.000 --> 00:00:30.000
Bubble sort repeatedly walks through the array and swaps neighbouring elements that are in the wrong order. After each pass the largest remaining element has bubbled up to its final place at the end.

00:00:30.000 --> 00:01:05.000
Selection sort works differently. It finds the smallest element in the unsorted part and swaps it into the next position. Both algorithms use two nested loops, so both take O of n squared time, which is fine for small arrays and far too slow for large ones.`,

    "Merge Sort": `WEBVTT

00:00:00.000 --> 00:00:30.000
Merge sort uses divide and conquer. It splits the array in half, sorts each half recursively, and then merges the two sorted halves into one sorted array.

00:00:30.000 --> 00:01:10.000
Merging two sorted lists is cheap: compare the front elements and take the smaller one. Because the array is halved each time, there are about log n levels, and each level does n work, so merge sort always runs in O of n log n time. The price is extra memory: it needs a temporary array of size n.`,

    "Quicksort and its worst case": `WEBVTT

00:00:00.000 --> 00:00:30.000
Quicksort picks a pivot element, partitions the array so smaller elements go left and larger elements go right, and then sorts both sides recursively. On average it runs in O of n log n time and sorts in place.

00:00:30.000 --> 00:01:10.000
The worst case is O of n squared. It happens when the pivot is always the smallest or largest element. If you always pick the first or last element as the pivot and the input is already sorted, every partition is completely unbalanced: one side is empty and the other has everything else, so the recursion goes n levels deep.

00:01:10.000 --> 00:01:40.000
You avoid this by choosing the pivot better: pick a random element, or use the median of the first, middle and last elements. Then sorted input is no longer a problem and quicksort stays fast in practice.`,
  },
};
