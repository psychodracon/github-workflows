FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY . .
RUN dotnet publish Fixture/Fixture.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/runtime:10.0-noble
WORKDIR /app
COPY --from=build /out .
ENTRYPOINT ["dotnet", "Fixture.dll"]
