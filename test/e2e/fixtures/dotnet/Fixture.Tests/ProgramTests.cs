using Xunit;

namespace Fixture.Tests;

public class ProgramTests
{
    [Fact]
    public void Greeting() => Assert.Equal("fixture ok", Program.Greeting);
}
