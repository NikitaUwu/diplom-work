FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["NuGet.Config", "./"]
COPY ["diplomWork/diplomWork.csproj", "diplomWork/"]
RUN dotnet restore "diplomWork/diplomWork.csproj"
COPY . .
WORKDIR "/src/diplomWork"
RUN dotnet publish "diplomWork.csproj" -c ${BUILD_CONFIGURATION} -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "diplomWork.dll"]