-- SQL Server features efcpt-ui is tested against in CI (test/e2e.test.ts): schemas, same-named tables,
-- special types, triggers, sequences, filtered indexes, keyless tables, C# keyword names, procedures
-- whose result sets are hard to discover, table-valued parameters and functions. Run with sqlcmd -I.
CREATE DATABASE Tricky;
GO
USE Tricky;
GO
CREATE SCHEMA hr;
GO
CREATE SEQUENCE dbo.TicketNo AS int START WITH 1 INCREMENT BY 1;
CREATE TYPE dbo.IdList AS TABLE (Id int NOT NULL PRIMARY KEY);
GO
-- same table name in two schemas
CREATE TABLE dbo.Customer (Id int IDENTITY PRIMARY KEY, Name nvarchar(100) NOT NULL);
CREATE TABLE hr.Customer (Id int IDENTITY PRIMARY KEY, Name nvarchar(100) NOT NULL, Notes xml NULL);
-- types
CREATE TABLE dbo.Kitchen (
  Id int IDENTITY PRIMARY KEY,
  Place geography NULL, Shape geometry NULL, Node hierarchyid NULL,
  Doc xml NULL, Anything sql_variant NULL, Img image NULL, Txt ntext NULL,
  Money1 money NOT NULL DEFAULT 0, Small smallmoney NULL, Tiny tinyint NULL, Real1 real NULL, Flt float NULL,
  Dt datetime NOT NULL DEFAULT GETDATE(), Sdt smalldatetime NULL, D date NULL, T time(3) NULL, Dto datetimeoffset NULL,
  Bin varbinary(max) NULL, Fixed binary(16) NULL, G uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
  IsOn bit NOT NULL DEFAULT 1, Ticket int NOT NULL DEFAULT (NEXT VALUE FOR dbo.TicketNo),
  Chars char(3) NULL, Json nvarchar(max) NULL CHECK (ISJSON(Json) = 1),
  Calc AS (Money1 * 2) PERSISTED);
-- trigger (EF Core needs HasTrigger for SaveChanges to work)
CREATE TABLE dbo.Invoice (Id int IDENTITY PRIMARY KEY, CustomerId int NOT NULL REFERENCES dbo.Customer(Id), Total decimal(18,4) NOT NULL, Updated datetime2 NULL);
GO
CREATE TRIGGER dbo.trInvoiceUpdated ON dbo.Invoice AFTER UPDATE AS UPDATE i SET Updated = SYSUTCDATETIME() FROM dbo.Invoice i JOIN inserted x ON x.Id = i.Id;
GO
-- keyless, unique index as alternate key, filtered index, self reference, multi-FK to same table
CREATE TABLE dbo.Employee (Id int PRIMARY KEY, ManagerId int NULL REFERENCES dbo.Employee(Id), Email varchar(200) NOT NULL, Badge varchar(20) NULL);
CREATE UNIQUE INDEX UX_Employee_Email ON dbo.Employee(Email);
CREATE UNIQUE INDEX UX_Employee_Badge ON dbo.Employee(Badge) WHERE Badge IS NOT NULL;
CREATE TABLE dbo.Transfer (Id int PRIMARY KEY, FromEmployeeId int NOT NULL REFERENCES dbo.Employee(Id), ToEmployeeId int NOT NULL REFERENCES dbo.Employee(Id));
CREATE TABLE dbo.Heap (A int NULL, B nvarchar(10) NULL);
-- names that are C# keywords or odd
CREATE TABLE dbo.[class] ([event] int PRIMARY KEY, [string] nvarchar(10), [1stValue] int, [Order Date] date, [Unit Price ($)] money);
CREATE TABLE dbo.Statuses (Id int PRIMARY KEY, Status nvarchar(20));
GO
CREATE VIEW hr.vEmployees AS SELECT e.Id, e.Email, m.Email AS ManagerEmail FROM dbo.Employee e LEFT JOIN dbo.Employee m ON m.Id = e.ManagerId;
GO
-- procedures: simple, output param, temp table (discovery fails), dynamic SQL, multiple result sets, TVP, no result
CREATE PROCEDURE dbo.GetInvoices @CustomerId int AS SELECT Id, Total FROM dbo.Invoice WHERE CustomerId = @CustomerId;
GO
CREATE PROCEDURE dbo.CountInvoices @CustomerId int, @Count int OUTPUT AS SELECT @Count = COUNT(*) FROM dbo.Invoice WHERE CustomerId = @CustomerId;
GO
CREATE PROCEDURE dbo.UsesTempTable AS BEGIN CREATE TABLE #t (Id int, Name nvarchar(50)); INSERT #t SELECT Id, Name FROM dbo.Customer; SELECT Id, Name FROM #t; END
GO
CREATE PROCEDURE dbo.DynamicSql @Table sysname AS EXEC('SELECT * FROM ' + @Table);
GO
CREATE PROCEDURE dbo.TwoResults AS BEGIN SELECT Id, Name FROM dbo.Customer; SELECT Id, Total FROM dbo.Invoice; END
GO
CREATE PROCEDURE dbo.ByIds @Ids dbo.IdList READONLY AS SELECT c.Id, c.Name FROM dbo.Customer c JOIN @Ids i ON i.Id = c.Id;
GO
CREATE PROCEDURE hr.Touch @Id int AS UPDATE dbo.Employee SET Badge = Badge WHERE Id = @Id;
GO
CREATE FUNCTION dbo.InvoicesOver(@Min decimal(18,4)) RETURNS TABLE AS RETURN SELECT Id, Total FROM dbo.Invoice WHERE Total > @Min;
GO
CREATE FUNCTION dbo.Vat(@Amount money) RETURNS money AS BEGIN RETURN @Amount * 0.2; END
GO
