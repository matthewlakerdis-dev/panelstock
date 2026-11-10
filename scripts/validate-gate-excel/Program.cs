using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
foreach(var file in args){
 Console.WriteLine(file);
 using var doc=SpreadsheetDocument.Open(file,false);
 var errors=new OpenXmlValidator(FileFormatVersions.Office2019).Validate(doc).ToList();
 foreach(var error in errors)Console.WriteLine($"{error.Part?.Uri} {error.Path?.XPath}: {error.Description}");
 Console.WriteLine($"Validation errors: {errors.Count}");
 if(errors.Count>0)Environment.ExitCode=1;
}
